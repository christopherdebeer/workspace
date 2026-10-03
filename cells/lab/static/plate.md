# Botanical plate

One plant from a seed, grown before your eyes and drawn as an engraving you can turn in your
hand, hand-coloured in watercolour. Drag to turn it, pinch (or the wheel) to come closer to whatever is under your fingers, two fingers to slide; left
alone it turns slowly.
`another` draws a new specimen; `grow again` grows this one again. The seed is in the address
(`?seed=412`), so a plate can be shared; `?preview` draws it small and quiet (the lab's index).

## The plant (`plant.ts`)

A seeded genome, then growth. The genome chooses:

- **Habit.** Upright, branching (side shoots from the middle nodes), or a rosette of leaves at
  the ground with a flowering stalk from its middle.
- **Leaf arrangement.** Alternate (the golden angle round the stem), opposite (in pairs, each
  pair at right angles to the last) or whorled (three at a node).
- **Leaf shape.** Lanceolate, ovate, cordate (heart-shaped), lobed, or pinnate (leaflets in pairs
  along a rachis), with a stalk or without, toothed or entire. Each leaf has a midrib that bends
  down as it goes, a slight fold along it, and side veins running forward to the edge. Leaves get
  smaller and more upright up the stem.
- **Flowers.** Solitary at the top, a spike (open below, still buds above), or an umbel. Each
  flower has its sepals, its petals opening from the bud, and its stamens.
- **Roots.** A taproot and fibrous side roots, drawn below the ground (a light broken ellipse
  marks where the soil was), as a plate shows the whole specimen.

**No two parts alike.** The plan (habit, nodes, branching, flowers) comes from one seeded stream;
how each part departs from it comes from another, so the architecture holds and the life is laid
over the top:

- **Leaves.** Size, angle and droop vary leaf to leaf. The halves are unequal, the blade twists a
  little about its midrib, and the tip curls to one side. Now and then a bite is taken out of the
  edge.
- **The lowest leaves** are often going: withered (shrunk, ragged, curled in, washed brown), or
  already fallen, a stub left at the node.
- **The stem** sways slowly along its length and zigzags slightly at each node. No internode is
  the same length.
- **Flowers.** Each petal has its own length, width and set. A flower nods or turns a little.
  The lowest flowers in a spike are sometimes gone over, their petals dropped.

Every part has a time of birth and of full size: the stem grows up node by node, each leaf
unfolds from its node (its outline and veins drawn on as it opens), flowers last. The plant is
given a Latin binomial: a genus made from the seed, an epithet from what it is like (*ovata*,
*cordifolia*, *spicata*…), and a note of its habit, leaves and flowers.

## The drawing (`main.ts`)

Not a shaded model translated into pencil, but what an engraver puts down:

- **Blades** (a leaf's or petal's surface) are opaque paper that hides what is behind it, hatched
  in the blade's own space. The strokes follow it, herringbone out from the midrib like its veins,
  more where it turns from the light, crossed where it is darkest, darker on the underside. Petals
  are left pale, with a little hatching at their base. Where hatching would be finer than the
  page can hold, it becomes a light tone.
- **Lines** go through the lab's pencil (`../kit/pencil.ts`, shared with Mistwood). A stem is a
  paper body with two contours, each side its own hand, and a few strokes along its shaded side.
  Everything finer (outlines, veins, roots, stamens) is one line, as heavy as it is thick. The
  pressure and drift run along each stroke, so a stem or an outline is one gesture.
- **The light** is fixed in the world, so as the plant turns its leaves darken and pale.
- **The paper's tooth** breaks up the graphite where it is laid down; the blank sheet is quiet.

## The colour: a watercolour wash

Hand-coloured, as plates were: a wash under the engraving (`ink only` turns it off; `?wash=0`
starts without it).

1. **The pigments** are drawn first, into a buffer of their own at half size (watercolour has no
   fine edges):
   - leaves in a sap green, each a little different, laid on more heavily where a leaf turns from
     the light and on its underside;
   - petals in the specimen's own colour (rose madder, cobalt violet, gamboge, ultramarine,
     vermilion, pale pink, or a white that is barely a wash), thinning toward the tip;
   - stems green; roots a pale umber.
2. **They are laid on the paper as a wash:**
   - a little off the drawing, as hand colouring always is;
   - soft-edged;
   - pooled darker at the rims where it dried;
   - uneven as the brush was wetter or drier;
   - granulating in the paper's tooth;
   - mixed as pigment mixes: multiplied onto the paper, so overlapping washes glaze.
3. **The engraving goes on top.** Its blades and stems keep hiding what is behind them, but their
   paper is clear, so the colour shows through the hatching.

`?washonly` leaves the engraving off, to see the wash alone.

## Next

- Fruit and seed heads; hairs on stems; tendrils.
- Details beside the specimen, as plates have them: a flower in section, a seed, a leaf.
- Stippling as well as hatching, and a cut ground line.
