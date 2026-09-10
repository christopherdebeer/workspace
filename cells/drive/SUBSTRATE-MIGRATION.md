# Road / terrain / water substrate migration

## Decision

Roads and water must stop behaving like independent ribbons laid over a third
terrain answer. The target is one versioned, layered substrate tile with:

- ground: the continuous terrain/earthworks surface and material;
- drive: an optional road, track, ford or structure deck;
- water: an optional body with surface, bed, shoreline, flow and visibility;
- structure: bridge deck, culvert roof or causeway fill where present;
- crossing: an explicit semantic relation, not a height-based guess.

A ground vehicle first resolves the highest valid solid support. It then
resolves exposed fluid above that support. Water below a bridge deck or inside
a culvert still exists, but is not vehicle fluid contact.

`client/substrate` is the executable form of that contract. The lab and tests
import the same implementation.

## What exists now

| Area | Current substrate work | Shipping production |
| --- | --- | --- |
| Layered data | Ground, drive, water, structure and crossing arrays in one tile | Revision-locked tiles retain exact terrain/contact triangles, renderer-neutral terrain/drive/structure/hydro-detail packets, road/channel vectors, the built hydro field and crossing records |
| Crossings | Bridge, culvert, ford and causeway resolve explicitly | Live records control structure choice, terrain fill/channel carve and hydro visibility; road/deck generation still comes from the legacy solver |
| Vehicle contact | Shared support + exposed-fluid resolver | `?substrate=contact` cuts centre, wheel support, fluid force and splash gates to exact substrate contact with legacy rollback |
| Hydro input | Production `HydroSample` / `HydroTileField` adapter, preserving unknown speed | Exact channel vectors provide physical speed where known; unknown speed disables current force |
| Bed and bank material | Canonical `silt/sand/gravel/pebble/rock` bed and `soil/mud/gravel/rock` bank categories | Categories survive OSM/authored input, body resolution, packed hydro fields, CPU contact, diagnostics and shaders without reducing them to turbidity |
| Diagnostics | `/lab/substrate`, production-hydro overlay, contact readout and fixtures | Shadow/contact modes report tile/fallback probes, revisions, support/fluid parity and crossing authority |
| Evidence | `VehicleWaterEvidence` owns wake strength, tyre/hull carry, drips and wet tracks | Production and `/lab/substrate` consume the same deterministic history and wet-mark renderer behind the contact rollback |

Shadow mode intentionally exposes disagreements without changing consumers.
The tile itself is the versioned production authority: its coarse diagnostic
raster cannot overrule exact terrain, road or hydro data, and a source revision
removes the whole authority tile before any consumer can combine stale terrain
with newer water.

## Inspecting the work

- Open `/lab/substrate`.
- Switch among bridge, culvert, ford and causeway.
- `PROD HYDRO` shows the shipping hydro field as a magenta wireframe.
- The lower readout compares canonical visibility, level and fluid contact.
- Sections in the dial panel are collapsible.
- In the game, add `?substrate=shadow`, then call `__substrate()` in the
  console. `__substrate('reset')` clears counters.
- Add `?substrate=contact` for the guarded consumer cutover. `__waterEvidence()`
  reports contact authority, wake strength, tyre/hull wetness and live stamps.
- Run `node devtools/substrate-drive.test.mjs` for the authored Senqu
  representative drive: exact field water, wake, wet tyres, exit tracks and
  drips are asserted in the shipping browser build.

Shadow mode is read-only. Contact mode uses the exact tile for support, fluid
and vehicle-water evidence while retaining one query switch back to the legacy
path.

## Migration stages

### 1. Keep proving the contract

Expand deterministic fixtures to cover skew crossings, junctions beside
water, multiple channels, tidal water, intermittent streams, steep banks and
tile seams. Every fixture must assert ground continuity, support, water
visibility, fluid contact and crossing identity.

### 2. Give production an authored crossing authority — terrain cutover landed

Build a production adapter that emits explicit crossing records from OSM
bridge, tunnel, ford, layer and culvert evidence plus the road solver's
structure decision. Unknown evidence must remain `unresolved`; it must not be
silently promoted to a ford, bridge or filled road.

The same record must be consumed by:

- terrain earthworks and channel carving;
- road/deck construction;
- hydro visibility and continuity;
- collision/support contact;
- lab and debug views.

The production registry and its pre-build intent resolver exist at the
culvert/bridge decision point. `bridge`, `ford`, `culvert` and `embankment`
evidence survives the client cache, water and road identity reach the event,
and construction consumes that one classification before choosing geometry.
Explicit causeways suppress conduit generation; explicit culverts force an
implementation attempt instead of being skipped by a clearance heuristic.
`__substrate().crossings` reports resolved, unresolved and
missing-implementation counts. `__substrate().crossingRecords` is a bounded,
deterministically ordered audit with unresolved and missing implementations
first, including source identities, authority, clearance and evidence. The
substrate lab exposes matching, missing, procedural and unresolved authority
states in its collapsible `AUTHORITY / PARITY` section. Built culverts and
causeways mask the hydro surface while preserving open mouths.

The synchronous and worker terrain kernels now consume the same oriented
crossing footprint. Bridges suppress road fill and keep the channel open;
culverts and fords retain road earthwork while carving a continuous channel;
causeways retain solid fill and block the channel; unresolved or missing
implementations preserve the conservative legacy plug. Crossing resolution
happens after the first overlap inspection, so each stable record revision
invalidates affected terrain and hydro exactly once. Narrow channels at road
crossings are inserted as centre/bed-edge breaklines before triangulation,
preventing a coarse triangle from bridging a correctly resolved culvert bed.
Exact oriented crossing footprints also outrank the coarse diagnostic raster
during contact. If tile clipping leaves a built crossing record without its
neighbour-owned road vector, the record retains its explicit deck support
through the footprint instead of misclassifying river-bed fluid as bridge
contact. Representative water probes reserve semantic crossing centres before
ordinary channel stations so this seam remains covered.
The production structures fixture verifies the open culvert, filled causeway
and converged rebuild queue through `__substrate().crossingEarthworks`.

The remaining crossing migration is to replace the legacy road profile/deck
builder with substrate-owned generation; it already consumes canonical intent
at the structure decision point, but it is not yet emitted from the substrate
tile itself.

### 3. Build one production substrate authority tile — guarded authority landed

For each live terrain tile, assemble the existing elevation, solved roads,
hydro body profiles and crossing records into the canonical arrays. Keep all
shipping outputs active while comparing:

- road deck and wheel support height;
- water presence, level, bed and shore distance;
- exposed/hidden/blocked water;
- fluid depth above vehicle support;
- crossing identity and structure clearance.

Tile revisions must invalidate every dependent renderer and contact cache
together. A newer water solve must not coexist with stale terrain or road
geometry under the same revision.

Query-gated production authority tiles now assemble live ground, solved drive,
hydro and crossing layers under one revision with the terrain, hydro and
crossing source revisions recorded alongside it. Narrow roads and crossings
are retained as exact vectors and records; exact terrain triangles and the
locked hydro field/channel vectors outrank the deliberately coarse 33×33
diagnostic raster. Bed and bank categories are carried through the exact hydro
field and contact adapters rather than inferred again by render or physics.
`?substrate=contact` makes this tile contact authority while the ordinary URL
remains the rollback.

Rendering now follows the same ownership rule for every local geometric layer.
Legacy terrain, road, structure and riverbed-detail builders still author
geometry during migration, but tile assembly no longer captures those meshes.
Terrain publishes its renderer-neutral packet while the kernel result is
applied. Profiled road decks, mutable draped tracks, junction/apron surfaces,
gallery and tunnel shells, luminaires and portal fittings now publish directly
from their geometry arrays without constructing a temporary renderer mesh.
Draped tracks retain only their `BufferGeometry` in the terrain re-seat
registry; packet attributes share those arrays and are admitted only after
redrape. Culvert bores/headwalls and rapid-bed geometry likewise publish their
final arrays directly; the matching structure generation or terrain revision
still gates admission. No local terrain, road, structure or hydro-detail
authoring path now needs a temporary renderer mesh in substrate mode. Once
terrain commits, its packet-instantiated visible mesh replaces the temporary
build mesh as the shared query/raycast authority. Consequently a settled
render-mode tile retains zero
hidden terrain, road, structure or hydro-detail source meshes. Terrain packet
positions are also the exact ground-contact array, so pixels and support cannot
diverge through a second copy. Attribute packets preserve their authored typed
component storage and normalized decode, including de-interleaving
renderer-owned layouts without expanding integer colours or masks to floats. A
source revision removes the complete visible packet; the next matching tile
revision reconstructs terrain, drive, structures, hydro details/colliders and
hydro atomically. An asynchronous stale tile request can refuse that commit,
but cannot discard a new road/detail packet while it waits for terrain redrape.
Diagnostics expose direct/build-authored packet counts, retained source
objects, bytes, conversion failures, rejection reasons and any accidentally
visible source mesh; browser cutover requires publication parity, every road
packet direct-authored, zero retained source meshes, source visibility and
failures.

Rapid-bed detail is also the first complete local detail builder moved behind
the substrate contract. `client/substrate/rapid-detail.ts` deterministically
resolves rock placement, side-weighted wakes and waterfall aeration, then emits
the exact position/colour arrays and matching collider witnesses without
importing the renderer. The legacy water solver still supplies the solved reach
stations, invert, speed and mitred offsets, but it no longer independently
decides where rapid rocks or their foam exist. Collider witnesses are copied
into the immutable substrate tile beside the detail render packet; activation,
revision replacement and invalidation now consume that tile payload rather than
the mutable authoring candidate registry.

Culvert shell arrays have begun the same migration. Once crossing intent,
clearance, conduit family and dimensions are resolved, the renderer-free
`client/substrate/culvert-detail.ts` builder owns the exact side walls, soffit
and optional twin-cell divider plus indexed, textured, oriented headwall
geometry. Contextual recipe selection and clearance sampling still live at the
legacy crossing build boundary.

### 4. Cut rendering over as one unit — terrain, drive and hydro guarded

Terrain, roads, river bed and water must be generated from the same substrate
revision. The renderer should use continuous shore distance and depth, not a
binary river mask, to provide:

- shallow edge translucency and wet-bank transition;
- visible gravel, pebble and rock bed in clear water;
- riffles, rapids, boils and bend eddies driven by flow energy;
- bank material and channel detail that continue into surrounding terrain;
- no hard water-mesh edge.

Dither and colour quantisation do not belong in these materials. They remain
the responsibility of the global post-processing pipeline.

`?substrate=render` now atomically instantiates terrain, drive, crossing
structures and hydro-detail meshes from immutable tile packets, activates the
matching rapid-rock colliders, and commits the exact hydro field. No source
terrain, road, structure or hydro-detail mesh is admitted to the scene. The
established builders remain hidden authoring inputs until direct substrate
generation replaces them; rollback therefore remains available without mixing
old and new visible layers.

The shared flowing-water shader now keeps the inland feather close to the
terrain colour until it meets the opaque body, strengthens continuous
shallow-edge terrain coupling, exposes a separate world-anchored pebble mask,
makes bend eddies affect both normals and restrained water tone, and breaks
rapid aeration into connected flow-aligned tongues with sparse broken crests.
The first rendered river fragment is now resolved from the same antialiased
coverage cut that constrains terrain topology, then widens through signed shore
distance and river-space depth into the shallow shelf. This prevents river N
and raster coverage from producing differently shaped bright and dark edges at
bends. The dry side uses the same metre-space wet-margin function in production
sward paint and the hydro lab. These are continuous material/field responses
only; no shader-local dither or quantisation was introduced.

### 5. Cut vehicle contact and evidence over together

The guarded change now routes centre/wheel support, fluid force, splash gates,
bow wave and hydro wake through exact substrate contact. A deterministic
`VehicleWaterEvidence` history owns retained wake strength, wet tyres, hull
drain, drips and terrain-hugging wet tracks. The production game and substrate
lab consume that same state and renderer. Evidence lifetime uses integrated
simulation time, so a slow frame or background resume cannot expire marks while
leaving wetness integrated on a different clock. The authored Senqu browser
drive passes this complete contact/evidence sequence. Default cutover still
waits on broader parity and visual gates below.

Production crossing audits now include the Bixby and Chapman's Peak seam
worlds. Bixby's explicit low-clearance culvert remains a compact built conduit
rather than being procedurally reclassified as a ford; Chapman's untagged,
water-covered, no-buried-room overlap records the open crossing that was
actually constructed as a procedural ford. Both worlds require zero unresolved
semantics, zero missing implementations, complete packet publication and zero
retained source meshes.

### 6. Retire duplicate authorities

After a release window with shadow telemetry and a rollback switch, remove:

- invented flow speed from a unit flow vector;
- channel-width depth fallbacks where a substrate field exists;
- independent road-versus-water ford tests;
- rendering-only water visibility rules;
- duplicate shore and bed classification outside the substrate build.

The bed and bank material part of the final bullet is now represented once in
the shared hydro/substrate contract and packed field. Shore-width, habitat and
fallback classification still have duplicate legacy consumers and remain in
scope for retirement.

Fallbacks may remain only for tiles whose substrate status is explicitly
unavailable, and must be counted.

## Cutover gates

No production renderer or physics cutover should occur until all of these hold:

- zero unresolved crossing semantics at observed road/water overlaps;
- no bridge-deck or culvert-roof probe reported as vehicle fluid contact;
- wet/dry disagreement below 0.1% over representative drives, with every
  disagreement captured by location and source;
- fluid-depth absolute error at or below 0.10 m at the 95th percentile and
  0.25 m maximum, excluding an explicitly documented source-data limitation;
- support-height absolute error at or below 0.03 m at the 95th percentile;
- production flow speed has an authority, or current force remains disabled;
- tile seam and revision tests pass for terrain, drive, water and structures;
- lab coverage includes every crossing and water regime;
- frame time, field memory and tile-build budgets remain within the existing
  production budgets;
- visual review confirms cohesive banks, shallows, bed material, turbulence
  and vehicle evidence without material-local dither or quantisation.

The current performance evidence is green. `hydro-resolution.test.mjs` measures
the production flowing tier at 23.3 ms and 3.84 MiB per 256² field, with mean
bank error improving from 2.53 m at 128² to 1.82 m. The production build-budget
harness completes the terrain/road build in 16 yielded slices with a 7.3 ms
longest main-thread hold; its software-render frame maximum is reported
separately and is not attributed to tile construction. Substrate render and
structure-render harnesses pass with zero page errors, exact flowing shoreline
terrain constraints, one edge-blended body per committed flowing tile and
atomic crossing packet admission.

`SubstrateShadowMonitor.readyForCutover` is deliberately conservative. It
stays false for wet disagreement rate at or above 0.1%, depth p95 above 0.10m,
depth maximum above 0.25m, support p95 above 0.03m, unknown speed authority,
unresolved crossings, tile fallbacks, too few total/hydro/immersed samples, or
no observed road/water overlap. `__substrate().gates` exposes every observed
value, comparison and threshold structurally; repeating dry probes can never
establish water parity.

## Rollback

Each cutover stage must retain one query/config switch for the prior production
path during its observation window. A rollback switches consumers back; it
does not mix old support with new fluid contact or old terrain with new water.
The canonical tile builder and diagnostics remain available after rollback so
the failed comparison can be reproduced.

## Known blockers

- Terrain, road, structure and most hydro-detail arrays still originate in
  separate legacy builders, although all publish immutable packet data at their
  authoring boundary and retain no hidden mesh wrappers after commit. Rapid-bed
  placement, foam, facet/colour and collider generation has moved into the pure
  substrate package, and its collider witnesses are versioned in the production
  tile. Culvert bore and headwall arrays are also substrate-built after the
  legacy context resolver chooses their dimensions. The remaining generation
  migration is to move the other array builders and reach/road/terrain solve
  authorities into the substrate tile build, then retire the legacy builder
  entry points and road drape registry.
- Contact/evidence cutover remains query-gated; representative water drives,
  wheel-level telemetry and parity thresholds are not yet complete enough to
  make it the default.
- Observed production overlaps still need a full classification audit beyond
  the now-covered Senqu, Bixby and Chapman's Peak cases, especially untagged
  fords versus procedural bridges, before unresolved geometry can be retired.
- Performance, field-memory and tile-build harnesses are green. Production
  world captures still need to confirm cohesive banks, shallows, bed material,
  turbulence, persistent evidence and seams under representative lighting and
  global post-processing.
- Duplicate legacy support, ford, shoreline and vehicle-water inference cannot
  be removed until default cutover and rollback observation are complete.
