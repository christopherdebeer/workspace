# Labyrinth: the look

The target: the concept studies (warm stone on a cliff over a turquoise stream, terracotta roofs, olives and cypresses, drawn as a miniature on paper). The style comes from convincing small-scale physical construction, shown with the restraint of an architectural illustration. Astra's read of the renderer: *surfaces have colour detail, but too little physical relief.* Stone joints and pores were drawn as colour; roof tiles were alternating colour on flat slabs; and the light still saw the underlying flat faces.

## How it's judged

One fixed place, the **study** (`?story=16`, demo.ts): three houses, a tower set into the cliff, an arcade, a stair, olives, the stream and its fall. It is drawn in the same four views every time (`node devtools/labyrinth-look.mjs --tag=NAME` → `static/labyrinth/look-NAME.jpg`). Every change to the renderer is looked at in these, before and after.

![before and after](labyrinth/look-compare.jpg)

## Stage 1: light, kept apart

- **Linear light, one display transform.** Material colours are authored as they're seen and converted back to light. They're lit in linear space, then go through the display transform once at the end:
  - exposure;
  - a filmic curve on luminance, so terracotta keeps its hue as it brightens;
  - the brightest values a little paler;
  - sRGB.
  
  Paper, ink and water marks stay in display space, after the transform.
- **The sun, the sky and what's thrown back, separately.**
  - The sun is warm and strong, and only its shadow shuts it out.
  - The sky is cooler and quieter, from above.
  - A warm bounce comes from below and the sides (sunlit ground and stone).
  
  The ambient occlusion now shades only the sky and the bounce, never the sun.
- **What the sky sees, baked** (mesh.ts `skyVis`). The vertex AO used to be a fixed gradient up each face. Now each vertex of stone, roof, timber and land casts 16 cosine-weighted rays a few cells through what's built and the land. So an arch's mouth is lit and its depth dim, a court is shut in, and a terrace is open. The old unconditional warm light in every arch is gone. Measured at about +46 ms per mesh build of the study, on this machine.
- **A sheen by roughness:** polished marble and glass most, then lead; travertine a little, brick and clay hardly.

## Stage 2: relief

- **Ashlar.** One block layout (courses three a level, each block its own length, staggered) drives:
  - each block's colour;
  - the recessed, paler mortar;
  - the rounded arris that catches the light;
  - each face a little out of true.
  
  The relief turns the normal the light sees; the ink still sees the face's own, so joints don't become ink lines. Tops get flags a cell each. Detail fades where it's smaller than a pixel.
- **Roof tiles in the slope's own frame**, so they're one size whatever the pitch:
  - round tiles in columns, caps and pans by turns;
  - courses up the slope, each tile's lip proud of the one below and throwing a little shadow on it;
  - each tile a shade of its own, now and then one weathered.
- **Real geometry where it changes the silhouette.**
  - At the eaves: the tile ends, a cap's round end over each crown and a pan's hollow end between, so the eave line is scalloped and throws its little shadows.
  - At ridges and hips: round cap tiles, each overlapping the next, with a boss where they meet.

## Stage 3: shadows and contact

- **The sun's map fitted to what's in the picture.** It covers what the camera sees on the ground, not the whole settlement, so close views get sharp shadows (the olives' leaves on the roofs). Its frame steps a whole texel at a time so edges don't crawl. Its bias and its softness are in world units, so they hold however close it's fitted.
- **Contact** (post pass): where something stands close in front of a surface (a wall's foot, the eaves, a riser under its tread), a little shade in the crease. It is oriented by the surface's normal, so convex edges don't darken, and it reaches only a third of a cell, so broad pale walls get no halo. Not on the paper land or the sky.

## Stage 4: the land, lit near what's built

Near what's built, the land is lit like everything else. Further out it breaks up raggedly into the drawing's marks, as a wash dries at its edge, then the paper. The three zones Astra described, by the drawing's reach:

- **Open ground:** warm earth and dry grass, greener where it's low and damp.
- **Steep ground:** limestone in its beds, with bedding lines across it, fractures down it, each bed's face a little out of true, and weathering at its foot.
- **The mesh:** steep ground is stepped into ledges a third of a level thick, so a cliff is broken by shelves, not a smooth sheet. Level ground, where things are built, is exactly as it was.

## Stage 5: water

The stream knows which way it runs (the next cell down, carried on its vertices) and how deep it is at each point (shallow at a dry bank).

- It's clear and turquoise as it deepens, over a pale bed that shows through in the shallows.
- Ripples are carried down its run, with streaks of froth in fast water and a pale wet line along the banks.
- The sky shows in it more at a glance, with the sun's glints.
- Pools and basins are still water, barely stirred.

## Stage 6: trees

- **Crowns cut through.** An olive's or a pine's crown is cut through where its leaf pattern thins, more at its rim, so its outline breaks into tufts. The same cut applies in the sun's view, so its shade on the ground is dappled.
- **Tufts shaded,** with darker hollows.
- **Light and sheen:** a little of the sun comes through leaves turned from it, and an olive's leaves are silver at a glance.
- **Limbs** run from the fork toward the furthest clumps, showing through the gaps.

Also: **telemetry.** A double tap on the title copies what drawing costs on the device as JSON:
- frame intervals and CPU time per frame (mean, p50, p95, p99, max);
- GPU time per pass, where the browser lets it be timed;
- mesh vertex counts and build times;
- GL renderer, extensions, screen and DPR.

Optimisation waits on these numbers from the phone.

## Stage 7: the land, the crowns and signs of life

![The four views after this pass](labyrinth/look-lived.jpg)

- **Open ground:** grey-brown earth rather than sand, under drifts of dry grass running from straw to olive, with a fine grain to the blades while they're big enough to see.
- **Wet banks:** each point of the land knows how near it is to the stream, both across and in height (baked on the mesh), so a bank is greener and darker where it's wet. A cliff the stream runs along the top or foot of stays dry.
- **Rock beds:** level, each a little thicker or thinner than the next. They step a little at their fractures, as settled blocks do, instead of waving.
- **Crowns as one mass:** each clump's normals lean toward the whole crown's, so a crown is lit as one mass with clumps swelling on it, darker underneath and toward its middle. Leaves are cut through only toward the outline, so the paper never shows through a crown's middle. The sun's view still cuts throughout, so the shade stays dappled.
- **Tops:** laid as flags in staggered half-cell rows, not one slab a cell square.
- **Signs of life:**
  - most windows have shutters in the house's paint (sage, blue-grey or oxblood): louvred, worn through to grey wood here and there, mostly folded back against the wall, a few closed;
  - now and then a door at the foot of a house has an awning of striped canvas with its valance.
- **On the phone:** shadows are now hardware-filtered (13 fetches instead of 34). A long press on the title runs a profile sweep that times the drawing with each costly part turned off in turn: sun map, multisampling, contact shade, leaf cutting, three-quarter and half resolution. The result is included in the telemetry copied by a double tap.

## Stage 8: from the picture to the page

![The four views with the softer ramp](labyrinth/look-bleed4.jpg)

The render no longer switches to the paper over a narrow ragged band. It goes over a broad one, by the drawing's reach:

1. **Rendered:** near what's built.
2. **Washed:** the render laid as a watercolour wash, lighter and less coloured. Its edge is crisp, granulated and pools a little darker, as a wash dries. The ink marks lie over it.
3. **Hatched:** in the wash's shade, the pen's hatching, crossed where it's darker. It's laid in the world so it stays on what it shades, and left out where the lines would crowd.
4. **Marks:** the marks alone on the paper.

- **Things on the land** (rocks, shrubs, trees) and anything built out toward its edge are washed the same way. Each takes the ramp at its foot, so a crown is never torn in two.
- **Ink lines:** how far along the ramp each pixel is gets handed to the post pass, which brings the lines up as the drawing takes over. They get heavier and are drawn at creases as well as folds, and on the land's ledges and banks too, broken.

**Foundations meet the land.** Where stone stands on the land, a skirt of the land's own ground is banked a little up its foot outside the plinth and settles onto the ground beside it, with its corners mitred. So earth and grass run to the stone instead of stopping at a line, damp and greener at the wall's foot where the rain off it gathers. Where the ground falls away, there's no skirt and the foundation's cut face shows.

## Next

1. **Terrain, further:**
   - near the city, coherent rock masses (ledges, fracture planes, rubble at the foot, soil on shelves);
   - foundations that meet the land (a skirt, a retaining course, a cut face);
   - the paper treatment kept for the outer margin.
2. **Vegetation:**
   - branches showing through the crowns;
   - clusters with gaps;
   - species-specific leaf orientation;
   - backlight;
   - restrained movement.
3. **Water as its own stage:**
   - depth and absorption;
   - flow-aligned motion;
   - foam at drops and obstructions;
   - wet contact at banks and piers.
4. **Composition and performance**, timed on the phone (the numbers here are software rendering, and mean nothing for the phone):
   - detail by projected size;
   - instancing;
   - render resolution;
   - HDR targets where the device supports them.
