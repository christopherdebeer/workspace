# Crystals

A mineral specimen from a seed, ray-traced in WebGL2. A cluster of crystals grows out of its
matrix; the key light goes through them and comes out the other side, bent, split into colour
at the edges, and thrown onto the slate as caustics. Drag to turn the specimen, pinch or scroll
to come closer. Left alone it turns on its own and the light wanders. "Another" grows a new
specimen; "grow again" regrows this one.

`?seed=` a seed (two words and a number, or a number) · `?mineral=amethyst|fluorite|zircon|…`
(a kind or a variety) · `?q=low|mid|high` (resolution, dispersion, the light sheet) · `?still`
(fully grown, no motion) · `?debug=caustic` (the caustic map as the ground sees it).

## The specimens

`client/crystals/mineral.ts`. A seed picks a variety and lays out a cluster. Each variety is a
habit — the shape its crystals take — a refractive index with its dispersion, and a body colour:

| kind | habit | varieties |
|---|---|---|
| quartz | six-sided prism, pyramid tip | rock crystal, amethyst, smoky, citrine, rose (milky, stubby) |
| beryl | six-sided prism, flat end | aquamarine, emerald, heliodor |
| tourmaline | rounded-triangular prism | rubellite, verdelite |
| fluorite | cubes | purple, green, Blue John |
| calcite | rhombs | Iceland spar, honey calcite |
| rhodochrosite | rhombs | rhodochrosite |
| topaz | four-sided prism, wedge tip | blue, imperial |
| garnet | rhombic dodecahedra | almandine, grossular |
| zircon | octahedra | zircon, hyacinth |

Every crystal is a convex hull: a list of planes in world space, which is all the renderer
needs, and which grows — radius and length, or the polyhedron's size — from a seeded start time
over a few seconds. Some habits taper toward the tip (tourmaline, tessin quartz). Some crystals
are twins: quartz a Japan-law pair, two prisms from one base at 84.5°; fluorite and zircon a
penetration twin, the same body turned 60° about a diagonal. The cluster sits on an ellipsoid of
dark rock, lumpy and crevassed, with a druse of tiny facets that glitter; the biggest crystal
near the middle and the rest leaning outward.

## The inside

Along the ray's first segment inside a crystal, a short march samples what the body holds, and
two things are met exactly:

- **colour zoning** between two body colours — the tip (amethyst, smoky, citrine), the core
  (tourmaline), or bands (fluorite, rhodochrosite);
- **phantoms**, ghost outlines of the crystal as it was;
- **veils and feathers** of fluid inclusions, patchy sheets that scatter the light (emerald's
  jardin, with its cracks);
- **bubbles**, sparse specks;
- **needles**, thin rods met exactly: gold rutile in rutilated quartz, tubes along the axis in
  aquamarine and heliodor, dark needles in almandine;
- **cleavage cracks**, two patchy planes, glinting with a thin film's colours.

The faces have their own character: striations across the prism faces in lines along the axis
(strongest on tourmaline), frosted faces on some crystals (an etched surface scatters), and
iridescent tarnish on patches of fluorite and zircon.

## The light

`client/crystals/shaders.ts`. Everything is traced against the hulls: a ray through a convex
hull has one entry face and one exit face, found by clipping against its planes, so the trace
is exact and cheap.

**The main pass** traces a ray from each pixel. At a crystal's face, a Fresnel share reflects
(and sees the scene one level deep); the rest refracts in — three times, at the index for red,
green and blue, which is the dispersion — walks the inside, reflecting internally where it
can't get out (four bounces at most), picks up the body colour along its path (Beer–Lambert),
and leaves through the exit face to see what lies beyond: another crystal (as plain glass), the
matrix, the ground, or the light. Milky varieties mix in a glow of the key light scattered
inside. The ground is slate, with the key light shadowed by the crystals and the matrix, the
caustic map added, and a glossy reflection of the scene.

**The caustic pass** runs first. The vertex shader sends a sheet of the key light's rays
(a square grid across the cluster, jittered a little each frame) through the same hulls, one
draw per wavelength at its own index, and splats a soft point where each ray lands on the
ground, into a half-float map with additive blending. The weight carried is what Fresnel let
through at entry and exit, less what the body absorbed. The ground reads the map; so does any
ray that reaches the ground through a crystal, which is how the caustics show through the
crystals themselves.

The light is a softbox behind the specimen from where you stand, a little to one side,
wandering slowly: it comes through the crystals toward you and throws its caustics in front of
them. A cool fill and a warm rim light give the facets something else to catch. Its shadow has
a penumbra, sampled across the softbox's disc. The air holds a little dust: the key light
scatters toward you along the view ray, forward-leaning, wherever the crystals and the rock let
it through, so the beam shows and the crystals' shadows cut it. The scene is rendered to a
half-float target; the glints and the caustics bloom (a soft-knee downsample, blurred twice),
and the final pass grades it — cool shadows, warm highlights — with a vignette, a little
chromatic aberration at the edges and grain.

## Checks

`node cells/lab/devtools/crystals.test.mjs`: the same seed is the same specimen; every variety
can be asked for; every hull holds its own axis at every stage of growth. `node
cells/lab/devtools/crystals-shot.mjs <dir>` renders four specimens and the caustic map headless.
