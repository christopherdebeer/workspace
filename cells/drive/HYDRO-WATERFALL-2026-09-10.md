# Geometry-driven waterfall refinement

Wet flowing meshes subdivide toward field resolution, capped at four subdivisions per axis; standing/surf budgets unchanged. This preserves field-resolved drops instead of bridging them with broad ocean-sized faces. No terrain cliffs are invented from coarse DEMs.

The shader detects positive downstream grade on the actual rendered face (0.55–1.50 smooth transition), not reach energy or cross-bank slope. Ripple normals preserve the steep face. Falling strands advect downward in absolute height with fixed phase rates and scene-lit aeration; detail fades with distance. No extra textures, particles or render passes. No changes to main.ts or physics.

Lab: RIVER / WATERFALL, 70m ledge, alongside graded river and pool–rapid controls. Limits: field/profile resolution still rounds unresolved cliffs; this is a falling-surface treatment, not a ballistic overhang or spray simulation. River tessellation increases up to 16x per wet parent cell, so mobile performance needs checking.

Verified: existing hydro self-tests, waterfall mesh/index/budget checks, TypeScript checks. Run node devtools/hydro-waterfall.test.cjs from src with esbuild and three installed. Browser WebGL unavailable in this environment: appearance, GLSL driver compilation and on-device frame cost remain unverified.
