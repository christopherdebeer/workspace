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

## Next

1. **Terrain integration:**
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
