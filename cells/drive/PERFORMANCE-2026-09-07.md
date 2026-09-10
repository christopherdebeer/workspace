# Vegetation and POI performance passes — 2026-09-07

Changes preserve tree selection, shapes, density settings, streaming road exclusion, instance colours, shadow split and pixel postprocessing.

- Visit square-ring perimeters directly in exactly the old order.
- Stable bounded nearest selection replaces full sorting when only a small prefix is retained; ties keep their original input order.
- Skip road queries for already-rejected plants; accepted plants still check current streamed roads.
- Upload only the active instance prefix after refills, and skip empty populations. Initial allocation still uploads the entire buffer.
- Size near/far pools independently and release replaced GPU instance buffers through InstancedMesh.dispose. Shared geometry and materials remain live.
- Apply stable nearest selection to scenery POIs, preserving pinned entries and namesake suppression.

Validation: strict TypeScript client check and esbuild parsing passed. Run `node client/perf-check.mjs` and `node client/upload-check.mjs` in a checkout with esbuild, typescript and three installed (validated with three 0.160.0). baseline-refresh.txt is the pre-change refresh function for comparison only.

The refill comparison executes original and revised production refresh functions in a deterministic mock world: 20 comparisons across population caps, range, movement, road arrival and capacity changes. Active matrices/colours/counts/admission records match. Dense 2.8 km fixture: 18,335 road queries became 1,160. Large-population pool allocation fell from 1,609,984 to 1,118,720 bytes. These are synthetic component measurements, not device FPS claims.

Upload tests run the actual Three WebGLAttributes/WebGLObjects implementation with a recording GL adapter for WebGL1 and WebGL2. A 10-instance matrix update sends 640 bytes instead of the full 65,536-byte capacity. Tests cover pending refills, empty populations and disposal/recreation.

Cloud browser could not initialize WebGL even before these edits. Visual equivalence and frame-rate improvement require a device run. Compare the same route, camera, settings and warmup period; track p95/p99, world:fx, updatePois and vegetation refill diagnostics. These passes do not remove hydro build stalls or establish that unexplained frame gaps are GPU time.
