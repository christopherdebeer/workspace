# Bamboo — buildable visual targets for hill climbing

Image-derived visual target studies (941 × 1672, portrait), not screenshots and not claims that their fine texture is
achievable in the first pass. Judge the **silhouette, spatial composition, occlusion, scale, readable path, and
feature-grounded marks** before photographic detail. `node cells/lab/devtools/bamboo-gates.mjs` draws each beside its
pinned scene in three modes (picture with marks off; ink only; board).

## The five views

1. `01-contour-run.jpg`, **primary baseline gate**: a narrow earthen contour track winding out of sight on a genuine
   steep hillside. Near moso culms substantial, with foreground parallax. Terrain rises on one side and opens between
   culms on the other. Route, bank, roots, grounded vegetation and their relationships before shading.
2. `02-culm-scale.jpg`, **species / scale gate**: clearly segmented, thick moso culms, white node bands, long open lower
   stems, foliage high in the canopy. Species-specific hierarchy, not more shrub geometry.
3. `03-ink-reach.jpg`, **representation gate**: near culms and path distinct while the less important grove resolves
   into selected culm and leaf strokes, sparse ridges, and paper. Colour may go; slope and route must stay legible. Ink
   belongs to objects and terrain features, not a painted screen-edge vignette.
4. `04-stair-event.jpg`, **occasional obstacle gate**: an irregular flight embedded into an existing path that turns
   round a significant boulder. Steps not repeated rectangular boxes, nor the dominant terrain type.
5. `05-gust-motion.jpg`, **motion stretch gate**: a travelling gust as spatially coherent sway through the high canopy;
   later, moving dapple and sound. A short camera/gust sequence is the actual test.

## Gates

**Gate 0, geometry and composition** (picture, marks off): a continuous heightfield and cut bank, not a floor plane with
decorations; an earth route with off-centre bends and changes of grade. 2–4 imposing foreground culms and successively
finer ranks behind, no jittered grid; moso radius, high branches. An occluding boulder or rock mass and roots placed
relative to routes; cliffs and stairs only when the context demands. Recognisable spatial structure at 390 × 844 with
flat two- or three-tone materials, modest light, no fog shafts, no paper.

**Gate 1, world-space drawing** (without rich shaders): at least three semantic mark families (culm contour and node
tick; trail and bank rim and hachure; path roots and litter). Marks anchored in world coordinates, steady under camera
motion and the culms' wind. Per-mark seeded retention: whole strokes leave the drawing; far things are not uniformly
ringed barcodes. Hidden or invisible geometry never occludes marks. In ink only, the route and bank are unmistakable.

**Gate 2, integration** (default board): a lit region round a path look-ahead focus, not the nearest sightline hit; the
near scene transitions by semantic features, not a radial wipe or image-wide fade; screen-space outlines only supplement
the structural marks; paper/colour/ink selection stable between adjacent moving frames.

**Gate 3, motion and finish**: moving at ~7 m/s with readable look-ahead and parallax; routes legible while turning; a
gust propagating through culms and canopy (footfall, wind, moving dapple, air depth); refined colour, light, powder,
lichen, canopy scatter, atmosphere, tone, wetness, paper grain.

## Not solvable by tuning shaders

Route layout; terrain cut/fill; a boulder occluding a bend; variable-density culm composition; a separate strokes layer;
hidden-surface rules; a stable route-informed focus; long-horizon runner guidance; composition-chosen fixed cameras.

## Test protocol

Pin explicit seed, camera position, heading, pitch, time and reach (`?cam=x,z,heading,pitch`), not `ref=` found by the
first matching terrain. Capture picture / ink only / board at 390 × 844; add a 5–10 s fixed-trajectory clip for parallax,
mark attachment and gust. Don't advance a gate until it passes in the less forgiving modes.
