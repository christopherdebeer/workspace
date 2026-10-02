# Botanical plate

One plant from a seed, grown before your eyes and drawn as an engraving you can turn in your
hand. Drag to turn it, pinch (or the wheel) to come closer; left alone it turns slowly.
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

## Next

- Fruit and seed heads; hairs on stems; tendrils.
- Details beside the specimen, as plates have them: a flower in section, a seed, a leaf.
- Stippling as well as hatching, and a cut ground line.
