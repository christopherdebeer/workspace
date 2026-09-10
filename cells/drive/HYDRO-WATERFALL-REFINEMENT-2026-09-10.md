# Connected waterfall refinement

Screenshots at Lower Yosemite Fall showed two opaque pale ribbons, a central dark slit, broad mottling and little impact connection. Screenshot evidence does not establish the exact cause of the slit.

Implemented hydro-only:
- waterfalls.ts detects connected steep reaches on the fitted downstream profile, requiring a peak grade >=0.75 and >=4m drop. Carries sheet strength, fallen fraction, landing/decaying downstream foam and total drop through an optional RGBA field. No landing is invented at an unresolved fragment end.
- River polygons now project height along the cached centreline segment instead of reusing a constant 2x2-block height. This removes a demonstrable staircase source on steep rivers. A 0.65m downstream/0.12m upward render-only stand-off on known sheets reduces intersection with independently triangulated terrain; fades with sheet strength. Visual confirmation of the central slit remains required.
- Falling strands use a free-fall travel coordinate minus global time, elongated across/along scales, darker water between strands, scene-lit aeration and a concentrated toe/decaying river tail. Suppress rapid heave on sheets. No particles or new render pass.
- Only drop/impact cells subdivide; neighbouring coarse cells stitch shared edges. Synthetic mixed patch: 3248 triangles vs 32768 previous global fine mesh. Ordinary river and standing budgets return/stay at 2048 triangles for the full 32x32 fixture. One extra float texture only in tiles containing drop evidence, bound only by falling river variants.

Validation: existing hydro self-tests, TypeScript, connected drop/quiet river/rapids/uphill/unknown landing cases, actual profile-to-field sheet and impact, finite data, triangle indexes, closed interior edges at adaptive joins. Run node devtools/hydro-waterfall.test.cjs. No WebGL visual, driver compilation or mobile FPS claim. Current profile/DEM resolution still limits overhangs; this is a supported surface approximation. Fall events across independently truncated profiles can need future registry stitching.
