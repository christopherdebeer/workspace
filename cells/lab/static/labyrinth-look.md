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

**Gathered round what's built.** The drawing's reach is no longer the box round everything built. It's a distance field over the land: each point knows how far it is from the nearest built column, recomputed whenever what's built changes. Two reaches come from it:

- **The picture's reach:** short, so full fidelity gathers round the buildings themselves.
- **The line's reach:** much longer, so the pen work (hachures, the cliffs' washes and drags, rocks, shrubs and trees drawn in outline) goes on across the land and thins out toward its edge.

Between them the render fades steadily, less coloured and paler, with the ink coming up over it. By the wash's edge it's barely a tint, so the edge is quiet and the picture and the page aren't at odds. The marks themselves are a little softer than straight ink. The wash is ragged only where the picture reaches, so there are no islands of it out on the paper. Leaves aren't hatched.

![Gathered round what's built](labyrinth/look-focus.jpg)

## Stage 9: after the transition studies

![After the render ↔ drawing transition studies](labyrinth/look-drawing.jpg)

These follow the two study sheets, [one](labyrinth/ref-transition-1.jpg) and [two](labyrinth/ref-transition-2.jpg) (continuous world, spatial legibility, construction grows, selective detail, persistent marks).

- **Paper and ink:** warm parchment, and sepia ink for every mark and line. The page behind matches.
- **Each feature at its own rate.** Where a point sits on the way from the picture to the page is worked out once, at the top of the shader, by the picture's reach at it (a thing on the land is judged at its foot), with an offset for each kind of thing:
  - what's built holds on longest;
  - water nearly as long;
  - then the ground;
  - trees soonest, going to drawn canopy while what they stand by is still whole.
- **Reduced texture first:** a material's fine detail goes before its colour and form do. Joints, tiles, pores, bed lines and grain all fade through the same switch that already drops what's too small to see.
- **Wash toward the paper's warmth:** colour drains toward the page's own hue, not toward grey, so the wash never reads paler than the page.
- **Drawn terrain in contours:** a line each third of a level, every third one heavier, where the ground is gentle enough for them to stand apart. Cliffs keep their hatching instead. The contours break here and there and thin out further away.
- **Drawn canopy:** a crown being drawn is cut through more, so its limbs show, and its tufts' edges get the pen's small scalloped marks.
- **Water continuous:** past the painted stream, a pale wash of its colour with its flow lines, as far as the lines reach.
- **Persistent marks:** the land's ink lines are no longer broken by a pattern fixed to the screen. Every mark is anchored in the world.

**Print is the page, not another renderer.** Printing used to turn the whole picture into a lithograph's screen of hatching. Now it's the far end of the same ramp, everywhere:
- every feature is drawn on the paper, with no paint, no tint and no water colour;
- the pen's lines, contours, hachures, drawn canopy and the shade's hatching all reach the whole of it;
- the post pass treats it exactly as it treats the page where the picture doesn't reach.

![Printed: the whole of it on the paper](labyrinth/look-print.jpg)

## Stage 10: marks with reasons (after Taohua)

![The drawing's marks, laid by the features that call for them](labyrinth/look-strokes.jpg)

![`?marks`: each mark coloured by why it's there](labyrinth/look-marks.jpg)

The first step of the architecture Astra's comparison with Taohua proposed: the illustration as an interpretation of the world, not a treatment of an image of it. The drawing's marks on the land no longer come from the shader reading a surface's height, slope or depth jump. They're geometry (`strokes.ts`), laid by the features of the world that call for them, after Taohua's `marks.ts` and `pathmarks.ts`. Each is a tapered ribbon in the world, so it stays put as the eye moves, and each is seeded from its own feature's cells, so it stays put as what's built changes elsewhere.

| Feature | Found from | Its evidence (family) |
| --- | --- | --- |
| escarpment | a run of cell edges where the land drops a level or more, the same way (not held by a wall, not built against) | a broken **rim** along the top, firmer the higher it is; **hachures** down the face, long and short by turns, interrupted at each bed; **bedding** along the face at the ledges the mesh steps it into, a little higher or lower across each fracture; a **fracture** down it now and then |
| retention | a column built on the land, its open faces | its **contact**, a broken line at its foot, on the land banked up to it |
| passage | each flight (`World.flights`), and each cell a hand-laid way walks through (`World.passages`), its level and its direction | a flight's worn **tread** nosings, now and then, most at its foot and head; its **string**s, its pitch along each open side (not between two flights laid side by side as one); a way's **edge**s along its open sides and its flags' **joint**s across it, heavier at its ends, crossings and where it meets a flight |
| water | the stream's cells, their order, their neighbours | **current** along the way it runs (crowding the outer side at a bend); a steep **bank**'s line; a **fall**'s streaks where the bed steps; the **impact**'s rings below |

- **Each family has its own presence over the full render:** a rim holds some, a hachure none, since the render already says what a hachure would. Where the drawing takes over, all of a mark is laid. Where it thins out, whole marks are left out by their pick, never faded.
- **Retired:** the shader's hachures, the cliff drags, the rim line it found from a depth fold, and the post pass's lines on the land's own folds.
- **Kept, for now:** the shader's contours and its tonal washes.
- **`?marks`** (and `--marks` in the look harness) fades the picture nearly to the paper and colours each mark by its family: rim red, hachure brown, bedding green, fracture purple, contact orange, current blue, bank teal, fall violet, impact pink, tread black, string olive, edge dark teal, joint tan.
- **Passages barely show near what's built,** where a way is rendered (its marks hold a little at most). Where a way runs out into the drawing, they're how it carries on: edges, joints, treads. That's the sheets' "surface → edges → implied route". Print (`--print`) shows them everywhere.

Next, in the order the comparison proposed:
1. **The shade's hatching made feature-driven.** It's still the shader's, laid uniformly over every shadow, and it's what most dominates print. Recesses, undersides and occlusion behind a feature should be hatched; open shade should be left to the wash.
2. **The land conditioned by construction:** the geology kept as it was made, and a second surface derived from it that what's built has cut and filled (excavation, embankment, retained earth), with the marks read from that. To be tried first on a single stair and crossing.
3. **Each channel's persistence by its feature,** in place of one ramp position for nearly everything.
4. **An outline policy by material.**
5. **`?ink`, a composition-only view.**

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
