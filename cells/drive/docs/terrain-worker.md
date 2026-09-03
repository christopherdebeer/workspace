# Moving the terrain build off the main thread

Status: proposal, 2026-09-03. Branch `claude/cell-drive-github-actions-ah1p88`.

## Why

Road profiles already solve in a worker (`client/roadprofile-worker.ts`,
`RoadProfileWorker`). The terrain tile build does not, and it is now the
main-thread cost of streaming. Measured at Camps Bay, one 200 s boot, from the
build ledger (`__buildLog()`, per-build milliseconds):

| | refinement on | refinement off |
|---|---|---|
| terrain builds during the stream | 89 (25 tiles) | 86 |
| main-thread time in builds | 8.2 s | 7.6 s |
| median build | 115 ms | 111 ms |
| worst build | 238 ms | 284 ms |

Every ~2 s of streaming the main thread stalls for 115–240 ms, which is 7–14
dropped frames at 60 fps on a desktop CPU and proportionally worse on a phone.
The corridor refinement is not the streaming cost (it is gated on the stream
going quiet, so zero refined builds ran during the stream); it lands after, at
125–350 ms a tile. A plain build is 16.6k vertices at `terrainSeg` 128, and the
per-build ledger time includes the post-steps that run after each build.

Where the 89 builds come from, by ledger reason:

- 26 `load` — first build as a DEM tile arrives. Unavoidable.
- 24 `tile:` — each DEM arrival dirties all eight neighbours
  (`loadTerrainTileInner`). Diagonals are unnecessary: they share only a
  corner, which the border rows already carry, and the slope shade reads only
  the four edge neighbours.
- 23 `owner:` — an owner rebuilt and its east/south followers' rows differed
  (`borderShared`). Part of this is order waste: a follower that builds before
  its owner in the same dirty set builds again.
- 14 `way` — ways landing dirty the 3×3 tiles around them (`dirtyTerrainAround`).
- 2 `cover`.

Two cheap cuts come first and are independent of the worker: drop the
diagonals from the arrival cascade, and pick the next dirty tile owners-first
(sort by `ty` then `tx`), so a follower builds once. Together roughly a third
of the streaming builds. The worker is the real fix: the remaining builds
become worker time, and the main thread's share per tile drops to the geometry
upload and the post-steps.

## What a build is today

`buildTerrainMesh(t)` in `client/main.ts` (search for it; the file is large):

1. **Heights, pass one** — `sampleHeight`/`hasHeight` over `heightTiles`
   rasters (the exact edge where the field has a tile, inside this tile where
   it does not), the sea floor from `sampleCover` and `seaSurfaceAbs()`.
2. **Corridor refinement** — `refineTileGeometry`: break lines from the strips
   in `cutCells` (`stripBreakLines`, `toeOut`), per-cell convex polygon
   splitting (`splitPoly`, `segTouchesBox`), T-junction repair, the vertex
   pool (millimetre keys, tolerant lookup), seeds and pins from the west and
   north owners' rows in `refinedBorders`, `ownerY`, heights via `corridorH`,
   kinds, the per-geometry cell triangle table (`cellTrisCache`).
3. **Carves** — `carveCorridors` (per-triangle least-squares against deck
   points, plain tiles only) and `carveChannels` (`channelGrid`,
   `channelFloorAt`, which asks `onCarriageway` — a road-grid walk).
4. **Borders** — `refinedBorderPins` (plain path), `storeBorder`; after the
   mesh is placed, `borderShared` dirties east/south followers.
5. **Colour, pass two** — `terrainPalette` on elevation, cross-tile slope
   (`sampleHeight` central difference), `coverPaint` (dithered cover read via
   `hash2`), kind tints, `areaTintAt` (OSM areas).
6. **Geometry** — `computeVertexNormals`, the `THREE.Mesh`, `terrainMatFor`
   with the per-tile normal map (`terrainNormalTex`, reads the raster and the
   neighbours at the edges), swap into `worldGroup`.

Then, in `flushTerrain`, the post-steps that need the placed mesh:
`reseatBuildings`, `redrape`, `hydroFeed`, `flushBatter`, `flushCulverts`.
Their share of the 115 ms is not yet split out; do that first (step 1 below).

## Design

A `TerrainWorker` built the way `RoadProfileWorker` is: the kernel is a
function whose `toString()` is embedded in a Blob worker source, no separate
bundle, transferable buffers in both directions, stats, and a synchronous
fallback when the worker fails to start (`?tworker=0` forces it).

The difference from the road worker is state. A road job is self-contained; a
terrain build reads most of the world. The worker therefore owns a **mirror**
of the terrain inputs, fed by deltas, and becomes the single writer of the
things the build produces.

### Worker-resident state (mirrored by delta)

- Height rasters: per tile `{tx, ty, xs, zs, w, h, data}`; transferred once
  on load (~256 KB each; 25 tiles ≈ 6 MB, duplicated — acceptable).
- Cover raster tiles (and the far-shell cover if `sampleCover` falls back to
  it), with the same "not loaded → null" semantics.
- Sea: `baseElev`, the sea datum. A datum change dirties every tile today
  (search `seaDatum !== was`); keep that, as a `reset`-and-redirty message.
- Strips: the `cutCells` segments as flat rows (`ax, az, bx, bz, hw, ya, yb,
  tk, tn, reach`) keyed by id, add/remove deltas as ways land and leave. The
  worker can answer `onCarriageway(x, z, 0.6)` from these; it does not need
  the road grid.
- Channels: `channelGrid` segments, same shape.
- Area tints: rasterise `areaTintAt` per tile on the main thread (cheap, it
  is a polygon test) and ship a small Uint8 tint map with the job, or ship
  the polygons once. Rasterising is simpler and keeps `areaTintAt` where it is.
- Border rows: `refinedBorders` moves into the worker. The main thread keeps a
  read-only mirror (updated from each result) for the probes
  (`__borderDiff`, `__bs`).
- Pure functions shared by both sides: `terrainPalette`, `coverPaint`,
  `hash2`, the palette tables, `mmKey`/`mmNear`/`onTileEdge`. These must
  compile without THREE or the DOM.

### The job and the result

Job: `{ key, tx, ty, xs, zs, w, h, seg, corridor, epoch, tint? }`.

Result (all transferable): `positions: Float32Array`, `uv`, `index:
Uint32Array`, `colors: Float32Array`, `normals: Float32Array`, `kinds:
Uint8Array`, `cellTris: { offs, tris }`, `border: Float64Array`, `normalMap:
Uint8Array (256×256×4)`, `refined`, `corridor`, `ms`, and the follower keys the
worker dirtied. The main thread builds the `BufferGeometry` from the arrays
(no compute), uploads the normal map into `terrainMatFor`, swaps the mesh,
updates the border mirror, and runs the post-steps.

### Queue, order, ownership

The dirty queue moves into the worker, which is where the ownership protocol
belongs: one builder, in order, holding the rows. Main sends `dirty(key, why)`
and the strip/channel/raster deltas; the worker sorts pending keys owners-first
(`ty`, then `tx`), builds one at a time, dirties followers whose rows differ,
and runs the quiet-path border audit itself (with the three-tries cap). It
computes `osmStreamQuiet` from the strip deltas it receives, so corridor
gating stays identical.

Stale results: a result for a key that was re-dirtied after its job was
queued is still applied (it is newer than what is on screen) and the pending
rebuild supersedes it. A result carrying an old `epoch` (a world hop) is
dropped, and a hop sends `reset`.

### What stays on the main thread

`reseatBuildings`, `redrape`, `hydroFeed`, `flushBatter`, `flushCulverts`
(they read the placed mesh through `groundAt`/`meshSurfaceAt`, which keep
reading the geometry arrays as they do now), texture upload, and every probe.
Target after the move: no main-thread task from terrain above 15 ms.

## Where it stands (2026-09-03, later)

Step 1 is done and measured. Per plain build (97 builds, Camps Bay stream,
`__refine().plain`): colour pass 69 ms, heights pass 24 ms, corridor carve
5 ms, normals 5 ms, everything else under 3 ms — of a 108 ms mesh build, with
17 ms of post-steps after it. The colour pass dominates: per vertex it reads
the climate field, samples cover twice through a linear scan of the cover
tiles, samples height four times for the slope, and tests the OSM area
polygons. The heights pass is the same lookups once. That is lookup overhead
more than arithmetic, and the kernel's store is where it gets fixed: a build
resolves its rasters once and indexes them directly.

The two cheap cuts landed but did not move the count (92 against 89): most
neighbour dirties were already deduplicated by the set, and the owner cascade
is across time — an owner rebuilt by a later way dirties its followers again
— not within one dirty set. They stay because they are right, not because
they paid.

Step 2 is done: `client/terrain-kernel.ts` holds the whole build over plain
arrays and a `TerrainStore`; `buildTerrainMesh` in main.ts is now the store,
the BufferGeometry wrap and the mesh placement. The main file lost 1,340 lines.
Verified against the parent commit: seam probes 0/0 on all edges at Camps
Bay and Senqu (settled on the full build count), through-node, carve-burial
and terrain-scan green, and an interleaved A/B at Camps Bay — head and parent
twice each, same script — settling at 151 builds every time with the same
reasons. Build counts vary with the road stream's batching by time of day
(87–96 in the morning, ~150 in the afternoon); compare against the parent
in the same hour, never against a number from another day. One bug shipped
and was caught: the plain lattice's cell table counted index entries, not
triangles (CLAUDE.md, "A cell table counts TRIANGLES"). The remaining test
noise — the Bixby join population, the corridor wedge budget, carve-through
at spots where the road stream has not landed inside the window — is
identical on the parent.

Step 3 is done: `client/terrain-worker.ts`. The kernel became one closure
(`createTerrainKernel`) whose source is embedded in a Blob worker, as the
road profile worker is, so the cell is still one bundle. The worker mirrors
the height and cover rasters once (a hop resets it) and takes everything
else with each job — the strips and channels near the tile, flat, with
their cell keys; the area patches; the landmark pads with their pad
elevations resolved; a 17×17 climate raster of biome weights; the palette
state and the constants. A job is self-contained on purpose: mirroring the
strips would mean shadowing every mutation a road makes to its segments
after they are rasterised, and the few hundred near a tile are tens of
kilobytes. Replies are transferable arrays plus the border row and the
followers to dirty; `applyTileBuild` wraps them and runs the post-steps.
One job in flight, the queue and its owners-first order still on the main
thread. `?tworker=0` keeps every build synchronous; a worker failure
disables it and the synchronous slot takes the tile back. `__tworker()`
is the ledger: jobs, worker ms, wait, prep, apply and post-step ms.

Measured at Camps Bay (rendering off, so the worker is not starved by the
software renderer): 83 builds to settle, all in the worker, borders 0/0 on
every edge. Main thread per build: 5 ms to pack the job, 0.2 ms to wrap the
arrays. The worker takes ~210 ms a build — its cover lookup is the linear
scan and every job recomputes the break lines — which is fine off the main
thread and the first thing to tune. With rendering on the main thread's
whole slot is 35 ms a build, median 24: 5 ms of packing and wrapping, the
rest the post-steps (reseat, redrape, hydro, batter, culverts), which are
now the residue. In the harness the software renderer starves the worker
(3 s of wait a job); on a GPU that is not a factor.

One pacing rule changed with the worker: the synchronous slot builds at
most one tile per 200 ms, and the worker path first inherited that, so the
twenty-five first builds at boot took five seconds and two road-stream
tests (Chapman's join population, the corridor's "truck is on a way") lost
their windows. The worker path now posts the next tile on the next frame
after a reply; both suites are back at their baseline.

Step 4 (the queue in the worker) is optional now: the main-thread share
of a build is the post-steps, not the ordering. Step 5 is the post-steps.

## Steps, each shippable

1. **Split the ledger.** Record `buildTerrainMesh` time and post-step time
   separately in `buildLog` (`flushTerrain` already brackets both). Five
   lines; it sizes the residue the worker cannot remove.
2. **Extract the kernel.** Move the pure parts into `client/terrain-kernel.ts`
   working over a plain object store: sampling (`hasHeight`, `sampleHeight`,
   `sampleCover`), palette and `coverPaint`, `refineTileGeometry` and its
   helpers (`stripBreakLines`, `toeOut`, `corridorH`, `splitPoly`,
   `segTouchesBox`), the `carveCorridors` solve, `carveChannels` with an
   injected `onRoad(x, z)`, the border helpers, the colour pass, vertex
   normals, and `terrainNormalTex`'s byte generation. Main calls the kernel
   synchronously — no behaviour change. This is the refactor step and where
   the tests guard it: `mesh-seams`, `corridor`, `through-node`,
   `carve-burial`, `carve-through`, `terrain-scan`, `build-budget`,
   `roadprofile-worker` as the pattern.
3. **The worker.** `TerrainWorker` with the state mirror and the deltas;
   results applied on main as above. Fallback to the synchronous kernel.
4. **Queue and ownership in the worker.** Main becomes: send deltas, receive
   meshes, run post-steps.
5. **Measure.** Builds per second, main-thread ms per build (upload plus
   post-steps), worker ms, and the seam probes unchanged: `__borderDiff` 0/0 on
   all edges at Camps Bay (`lat=-33.9476&lon=18.3843`), Senqu
   (`lat=-30.7523&lon=27.7178`), Vélizy; `__buildLog` reasons and counts
   unchanged; `__tstats().builds` settles.

## Risks and gotchas

- `hasHeight`/`sampleHeight` at the exact edge (the half-open tile box hands a
  border point to one raster) must be byte-identical in the kernel; the seam
  walls of 2026-09-03 came from a one-line change to this read.
- The vertex pool and border rows match within 1.5 mm in Float64; keep the
  tolerant lookups (`mmNear`) — Float32 world coordinates at 3.4 km from the
  origin rounded two copies of one point into different millimetre cells and
  produced a permanent rebuild loop.
- `terrainSeg` is a quality dial (search `terrainSeg = want`); it is a job
  parameter, and a change redirties every tile.
- Cover tiles arrive asynchronously; a build with cover missing paints the
  fallback today and is redirtied by `cover`. The mirror must reproduce that.
- Result size: a refined Camps Bay tile is 50–70k vertices, ~3 MB per result.
  Transfer is zero-copy; reuse buffers to keep GC quiet.
- The probes (`__vtxAt`, `__meshAt`, `__borderDiff`, `__bs`, `__refine`,
  `__buildLog`) read main-side state; keep the mirrors current or the seam
  measurements lie.
- Two known pre-existing test failures, unrelated: `mesh-seams` Bixby join
  population (4 against a bar of 5, every quality bar green) and `corridor`'s
  wedge-budget assertion (0 of 3 over budget). Both fail identically on the
  parent of the seam work.

## Acceptance

Streaming at Camps Bay with no main-thread task from terrain above 15 ms
(long-task attribution needs a real GPU; the harness renders in software and
its long tasks are rendering, so measure with the ledger and a desktop
profile), seam probes 0/0 at the three spots, the ledger's build counts and
reasons unchanged, and the test list above green apart from the two known
failures.
