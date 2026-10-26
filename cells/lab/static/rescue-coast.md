# Rescue · Rocky Coast

**Lily's Rescue Race, presented as a separate coastal-visual experiment.** The original [Rescue Race](/rescue) remains available and unchanged. This experiment lives at `/rescue-coast`.

## The game (unchanged)

Choose one of five big boats. Pilot near people waiting in little coloured dinghies; they wave and transfer aboard automatically. The five big boats compete to rescue the most people and reach the finish. First through fifth are ranked by people rescued, with crossing order breaking ties. The seeded level, AI, boarding timings and finish logic come from the existing `client/rescue/race.ts`.

## iPhone screenshot feedback · second rendering pass

The first screenshots confirmed the five-boat competition, rescues and finish run. They also exposed the visual problems: beige boats instead of RNLI-style vessels, an overly distant overhead viewpoint, isolated polygonal rocks, very straight white wakes and a pastel harbour. The second pass changes those causes: fleet livery, closer camera, larger figurines, striated cliff ribbons, stone cottages and a short-lived wake model. This remains a stylised procedural study, not yet a photoreal model.

## Visual direction

A deliberately small, detailed, RNLI-inspired physical miniature photographed on a temperate British rocky coast. Keep the little people vivid and readable; the water, rock, fibre-glass and metal should look physically different. Unlike the existing Rescue Race's bright tropical seaside, this version emphasises:

- Slaty, sculpted coastal stacks, fractured headlands and sparse grass.
- Layered deep-blue sea and green-turquoise shallows, crest whitewater, coastal wash, sun glints, and boat wakes.
- A richer rescue launch: continuous inflated collar, metal handrails, fenders, radar structures, lifelines, marker light and framed wheelhouse. Detail is merged into the existing instanced vessel mesh.
- Slightly lower trailing camera, with the same hold-to-steer interaction and automatically animated passenger transfers.
- Adaptive mobile rendering resolution.

## Architectural boundary

`client/rescue-coast/main.ts` is a standalone entry adapted from the original view/controller and importing the original pure rules and effects. `sea.ts` modifies both the CPU wave sampler and generated GLSL identically so a bobbing boat does not disconnect from the sea. `render.ts` is an independent fork of the original WebGL2 renderer, with coastal water and terrain materials. `mesh.ts` composes the original hull and familiar people with extra geometry and geological dressing.

**Non-goals of this first stage:** physically-based normal maps, authored GLB character rigs, accurate shore breaking wave simulation, dynamic weather, spray physics, networking. The procedural study does not yet claim the full quality of the generated reference image.

## Validation

Use `?preview` for a running thumbnail; `?auto&t=45` for a mid-race camera; `?near=0&auto&t=20` for boarding composition; `?view=podium` for the result; and `?seed=...` to compare the same sea with the original route. `window.__rescue.variant === 'coast'` identifies this experiment.

Future passes: sculpted coastal models, bespoke lifeboat GLB, higher-quality figurines, shore-facing whitewater rather than solely depth masks, and mobile screenshot/performance evaluation against Lily's reference.


## Fidelity pass 3 · 26 October 2026

### Critique against Lily's coastal references

The preceding version was a low-poly race renderer with coastal dressing. Its strongest parts were the working five-boat rules, shared buoyancy surface and instanced geometry. Its largest visual gaps were uniform material lighting without cast shadows; widely spaced water vertices; a rectangular cabin; visibly faceted cliff ribbons; and passengers spinning through high jumps. A distant lineup also concealed the details that had been added.

The references ask for rounded manufactured boats, small sculptural people, warm mineral cliffs against deep blue water, broken whitewater and photographed-miniature lighting. This pass addresses those rendering foundations rather than adding the stars, missions or upgrades seen in some generated boards. Those features are not part of Lily's rules.

### Implemented

- Sun shadow map with 3×3 PCF filtering and snapped light-space translation, centred near the foreground fleet. Geometry, people and cliffs cast shadows onto opaque surfaces. This is not a full contact-AO or reflection system.
- Separate painted, rubber, metal, fabric, glass and mineral surface responses. Warmer sun and stronger cool fill replace the former uniform bright rim.
- Rounded cabin shell and roof, smoothed hull sections and tubular fittings, orange rubbing strip, raked three-pane front windscreen, vent slats, cleats and foredeck mat. The boat remains a procedural mesh, not a supplied GLB asset.
- Lifejacket panels, reflective strips, buckles, boots, ears, noses, small smiles and white rescue helmets. A visible crew member is present before any passengers board.
- Five shared analytic wave components with a second harmonic to sharpen crests; CPU buoyancy and generated GLSL use the same equations. These are shaped height waves, not a horizontal Gerstner displacement implementation.
- Nonuniform ocean grid: roughly 0.65m spacing nearby, expanding to cover about 870m. More directional water colour, broken foam, retained stern turbulence and ballistic bow droplets.
- Closed cliff tops, less arbitrary face-to-face colour variation, softened geological normals, mineral relief and wet bases. Alternating right-hand coves interrupt the continuous high cliff corridor. The original collision heightfield is retained.
- Directional sky gradient and procedural clouds; lower camera, closer selected-boat lineup. `?study&seed=5&auto&t=20&still` offers a clean, low-camera inspection view.
- Passenger transfers lose the full spin and exaggerated leap. This remains a short transfer animation; docking, stabilisation, climbing and hand/foot contacts are still outstanding.

### Validation and limits

TypeScript was stripped successfully for all local modules. Geometry checks covered finite attributes and unit normals; coastline generation ran for three seeds. Five hundred analytic wave derivative checks passed with maximum error below 1e-9. Three complete AI races (seeds 5, 7, 92) finished with five ranked boats.

All seven GPU program combinations compiled and linked under Mesa EGL/OpenGL ES 3. A staged coastal scene replayed the actual Renderer draw calls with no GL errors; two angles were inspected and used to correct dark lighting, cliff colouring and boat geometry. This is an offscreen renderer check, not an end-to-end browser or iPhone Safari test. Browser installation was unavailable in the execution environment. Mobile performance has not been measured for this pass, especially the additional shadow pass.

### Still below target

The rock silhouettes still reveal procedural construction. Boat proportions and tiny character expressions need further model work. The ocean lacks shore-facing breaking wave geometry, reflected scenery and persistent foam advection. Existing heightfield collisions and added cliff meshes are not one unified coastline representation. A proper alongside-and-climb rescue needs a coordinated simulation/animation change. This pass should not be described as matching the generated reference yet.
