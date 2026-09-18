# Terrain and frame-cost review — 2026-09-15

Reviewed the remote cell against the Yosemite iPhone telemetry, build f2a06db31e94 (12.3 fps, p95 223 ms). Edited only client/main.ts and client/hydro/build-tile.ts with exact replacements; fresh reads matched before editing and readback matched afterwards.

## Changes

- Residual normal textures now reuse only when both the DEM array identity and mesh coarse-pixel ruler match. The old tile-only cache could retain a residual calculated for another terrain resolution.
- Engineered cut-face material shares are calculated before the generic fine-detail handoff. The material and generic cascade now use the same mineral shares, removing duplicate ownership at cuts.
- Default tree slices are 5 ms and sward slices 3 ms, independent of smoothed frame duration. The previous frame/6 rule enlarged CPU work during already-slow frames. Generator units can overshoot these budgets; these are not hard deadlines. Existing tree population, geometry and completed field staging remain. Explicit vegstep overrides remain available.
- Hydro profile indices cache ordered, deduplicated candidate neighbourhoods within one build. Repeated texels no longer redo nine bucket lookups and retest duplicated segments. Candidate encounter order is preserved for ties.
- Hydro majority repair skips immutable 3x3 neighbourhoods whose coverage is entirely zero. Extended river-kind metadata previously made empty regions pay the full nested arithmetic loop.

Deployment completed as version 1789482401999. The served app.js returned HTTP 200, contained the new normal-cache and scheduling symbols, and passed esbuild parsing. This confirms shipment and JavaScript syntax, not runtime GLSL correctness.

## Validation and limits

Esbuild parsing passed for both edited TypeScript sources. Executed the actual normal-cache function with texture mocks: matching inputs reuse; changed coarse ruler and replacement DEM invalidate and dispose the old texture. Verified cut shares precede the handoff.

Compared original and edited complete hydro builds, every output property, for 12 synthetic cases: dry, diagonal river, meander, lake with island, river area with centreline, and crossing rivers, each at 128 and 256 field resolution. All outputs were identical. Single-process timings were lower after the edits, but no device FPS claim is made from synthetic timings.

Live browser validation was attempted before deployment and failed because the cloud browser cannot create a WebGL context (GL_RENDERER Disabled). No visual comparison, GLSL runtime validation, full-project typecheck or iPhone FPS measurement was completed here.

## Remaining critique and priority

The geomorphic field, layered grass/mineral expression, separate colour and relief, and residual-normal composition are useful foundations. Rock microstructure is still evaluated largely in horizontal xz coordinates; steep cliff faces can therefore stretch fine grain vertically. A face-aware mapping needs a deterministic steep-wall fixture and a visual comparison before adoption. The geological family is inferred from morphology, not a geological survey.

Tilt shift reuses the existing soft texture; it introduces no separate blur pass. Its blend has a single blur scale and is not depth-aware, so inspect foreground/background silhouettes for halos. Neither render CPU time nor the unmeasured frame gap establishes GPU cost.

Hydro still builds synchronously and remains the leading stall risk. These optimisations reduce repeated work rather than guaranteeing sub-frame builds. A proper worker bridge must serialise registry/profile state and preserve revision rejection; scheduleBuild's closure API alone does not offload computation. Measure the new same-route phone dump before expanding this change. HUD and POI CPU work, terrain shader GPU cost, and the approximately 2.2M world triangles remain substantial candidates.
