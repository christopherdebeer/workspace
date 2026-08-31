# Drive artwork prompts

These are the production prompts for replacing the deterministic placeholder
artwork. Generate the icon and splash independently; do not derive one by
cropping the other.

## App icon

```text
Use case: logo-brand
Asset type: master app icon for iOS, Electron, and a maskable progressive web app icon
Primary request: Create a bold, compact emblem for Drive, a top-down driving game built over the real world. Show one unmistakable top-down expedition vehicle following a single sweeping road through an abstract cartographic landscape.
Scene/backdrop: Full-bleed dark terrain with sparse contour lines and simplified map cuts; no horizon and no sky.
Subject: One top-down vehicle and one broad S-shaped road, reduced to strong geometric silhouettes.
Style/medium: Restrained pixel-game art translated into a polished screen-printed emblem; hard edges, flat stepped tones, coarse purposeful detail, not literal low-resolution pixelation.
Composition/framing: Square 1:1 composition. Centre the mark. Keep the vehicle and recognisable road shape inside the central 60% so they survive circular, squircle, and aggressive maskable crops. Let only the background and secondary contour lines reach the edges.
Lighting/mood: Night navigation, quiet and exploratory, high silhouette contrast.
Color palette: Near-black charcoal #05070c, deep navy-green #0d1b1d, oxidised teal #2f7770, warm signal gold #e3b84f, and a small amount of warm off-white #efe9dc.
Text (verbatim): ""
Constraints: Opaque full-bleed background; no transparency; no pre-rounded corners; no outer border; readable at 32px; one visual focal point; broad shapes rather than thin linework; suitable as an App Store icon, desktop icon, favicon, and PWA maskable icon.
Avoid: Any words or letters, watermark, logo presentation mockup, app-store badge, map pin, compass rose, steering wheel, photorealism, glossy 3D bevels, chrome, lens flare, busy street grids, tiny labels, thin fragile details, purple.
```

Generate at `2048x2048` or larger, then downsample to the platform sizes. The
final iOS icon must be an opaque `1024x1024` PNG with square corners.

## Launch / splash artwork

```text
Use case: stylized-concept
Asset type: edge-to-edge iOS and mobile launch artwork
Primary request: Create an atmospheric top-down cartographic scene for Drive, a game about driving through the real world. A lone small expedition vehicle follows a sweeping road through dark layered terrain, with sparse contour bands suggesting a much larger unseen landscape.
Scene/backdrop: Abstract night map viewed exactly from above; broad terrain fields, restrained contour lines, subtle road cut, no horizon and no sky.
Subject: A small warm-gold top-down vehicle on one curving road near the exact centre.
Style/medium: Refined pixel-game concept art with screen-printed flat layers, hard edges, stepped tonal bands, and coarse map texture; cinematic through composition rather than gradients or effects.
Composition/framing: Square 1:1 master designed for aspect-fill on tall phones, tablets, and landscape windows. Keep the vehicle and meaningful bend of the road inside the central 35%. The outer 35% on every edge must contain only expendable terrain atmosphere so any crop remains intentional.
Lighting/mood: Pre-dawn navigation, isolated but inviting, subdued contrast at the edges and a restrained signal-gold focal point in the centre.
Color palette: Near-black charcoal #05070c, deep navy-green #0d1b1d, oxidised teal #2f7770, muted mineral blue #24404a, warm signal gold #e3b84f, minimal warm off-white #efe9dc.
Text (verbatim): ""
Constraints: Opaque edge-to-edge image; seamless visual weight at every edge; no transparency; no UI; no logo or title; central subject must remain legible after aggressive portrait or landscape cropping; broad shapes that survive display quantisation.
Avoid: Any words or letters, watermark, loading spinner, phone mockup, map labels, map pins, compass, horizon, photorealism, glossy 3D rendering, bright white edges, detailed city grid, purple.
```

Generate at `2048x2048` or larger. Export the selected master as an opaque
square PNG and resize it to the dimensions required by the asset catalogue.
