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
