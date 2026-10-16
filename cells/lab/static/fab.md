# Fab

A dressmaker's workbench for children. On the bench stands a little wooden figure on a turned stand; it wears what
you make it. For each thing it can wear (a **skirt**, a **top**, a **cape**) there are the same six dials, and they
don't choose a garment from a list: they make one. Each turns the garment's *pattern*: the flat pieces it's cut from,
drafted to the figure's own measurements. The pieces are cut, laid round the figure, sewn up their seams, and let
fall as that cloth would. So the dials meet in the cloth, and every turn of every dial is a different garment.

Drag the figure to turn round it, pinch or scroll to come close. Tap a slot to dress the figure in it; tap the one
you're on to take it off. **pattern** shows the pieces laid flat on their cloth, as they're cut; **surprise me**
spins the dials.

## The dials

| dial | skirt | top | cape |
|---|---|---|---|
| **shape** | length: mini → maxi | length: cropped → tunic | length: short → floor |
| **silhouette** | flare: pencil → A-line → circle | ease: fitted → trapeze | sweep: half a circle → a whole one |
| **drape** | cloth gathered into the waist | ease at the body, puff at the sleeve head | gathered at the neck |
| **pieces** | gores: 2 → 10 | sleeves: none, cap, short, three-quarter, long | panels: 1 → 6 |
| **fabric** | tulle → silk → cotton → linen → wool → felt | | |
| **print** | plain, stripes, gingham, spots, flowers, stars, in four colourways | | |

How they meet: a skirt flared toward a full circle has a hem three times its waist, so it can only fall in folds,
and how it folds is the fabric (felt stands out in a bell, silk hangs in deep soft folds, tulle floats). Gathered at
the waist, each gore's top is longer than its share of the waistband and ripples into it. More gores is more seams,
and a stripe printed on a flared gore runs at an angle, so it chevrons where two meet. A top's sleeves are set into its
armholes; puffed, their heads are wider than the armhole and gather.

## How it works

`client/fab/`.

- **The figure** (`body.ts`): a child's proportions in centimetres, a torso lathed through elliptical sections
  (hips, waist, chest, shoulders) with capsules for its neck, arms and legs and balls at its joints. The same shapes
  are what the cloth meets: a distance to the body at any point, and which way's out (the torso's way out leans
  upward where it narrows to the shoulders, so a top can rest on them).
- **Pattern making** (`pattern.ts`): each slot's dials draft its pieces as grids over flat shapes: a skirt's gores
  are annular sectors (a circle skirt's limit) or trapezoids, its waist edge the waist's girth (plus gathering)
  shared out; a top's front and back follow the body's girth at each height, eased and flared, with a neckline, and
  its sleeves are tubes whose heads are sewn round the armholes; a cape's panels are sectors hung from the neck.
  Each piece also says where it's laid round the figure before sewing, which edges sew to which, and what's held
  (a skirt's waistband, a top's shoulder seams, a cape's neck).
- **The cloth** (`cloth.ts`): position-based dynamics. Every point keeps its *flat* distances to its neighbours
  across and down (so a piece wants to be the shape it was cut), across its diagonals, and two along (bending: how
  stiff the fabric is). Seams draw their edges together over the first moment, as if stitched; gravity; the body
  pushes the cloth out, each garment kept its own layer's distance off it (a top lies over a skirt, a cape over
  both), and holds it with the fabric's friction. Turning a dial re-cuts the pattern and starts each point where the
  same place on the old piece was, so the garment reshapes rather than being sewn again.
- **Fabric and print** (`fabric.ts`): weight, bending stiffness, friction, and how it takes the light (silk's
  sheen, wool's fuzz at a glance, a weave, tulle's see-through), blended along the dial. The print is laid on the
  flat pieces (the shader draws it from each point's place on its piece), as on real cut cloth.
- **Drawing it** (`render.ts`): WebGL2. A shadow map from the window light, so folds shade the cloth beneath them;
  a wrapped diffuse for cloth; stitching drawn just in from every piece's edges. The pattern sheet (`sheet.ts`)
  lays the pieces out flat on pattern paper, each with its print, its cutting line and its stitching.

`?skirt=` `?top=` `?cape=`: six hex pairs, one per dial in the order above, or `off` · `?slot=skirt|top|cape` (the
one the dials turn) · `?preview` (no controls; it turns slowly).
