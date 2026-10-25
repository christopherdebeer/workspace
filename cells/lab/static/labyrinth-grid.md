# A finer grid? The courtyard house three ways

The question: should a placed cell be four of today's in plan, its storeys as tall? Then thin walls and narrow paths come by default, and today's masses are built up out of them, so there is room for the in-between: piers, setbacks, recesses, pilasters. This spike builds one fixture three ways and compares them. Measurements come from `devtools/labyrinth-grid-spike.mjs`.

- **Cells** (story 17): the courtyard house as it is.
- **Half grid, as cells** (story 18): the same house on the half grid, each cell made four. This measures what the house costs there.
- **Half grid, its own** (story 19): the house as the half grid would build it:
  - wings a cell and a half deep;
  - a gallery of piers half a cell thick along the north wing's court side;
  - its top storey set back half a cell;
  - the gate recessed half a cell into the south front, between pilasters;
  - the court split by a thin wall with a gate in it;
  - a forecourt walled thin, with a path half a cell wide.
- **Edge walls**: walls on the lines between cells, rooms filled between them. This is reckoned by hand below, because the model has nothing to build them with yet.

`?plan=0.5` draws a half-grid world in its own proportions: squeezed in plan, its storeys as tall as before. It is for looking only. A touch strikes where it would have struck unsqueezed.

![the three at a phone's size, and the half grid zoomed in](labyrinth/grid-spike.jpg)

## What it costs to draw

These are medians of five, in node, on the bare slab. "Replay" is building the world from its ops; "mesh" is everything drawn (buildings, fronts, roofs).

| | cells | replay | mesh, middle sea | vertices | mesh, plateau | vertices |
|---|---|---|---|---|---|---|
| 17 cells | 122 | 44 ms | 150 ms | 92k | 76 ms | 51k |
| 18 half grid, as cells | 488 | 60 ms | 248 ms | 157k | 156 ms | 67k |
| 19 half grid, its own | 431 | 19 ms | 194 ms | 95k | 226 ms | 102k |

- **Mesh time:** the same house on the half grid costs 1.6–2× as long to mesh. The half grid's own house costs 1.3–3×. On the plateau, its extra arches and bays make it dearer.
- **Vertices:** these stay within 2×.
- **Grid size:** the cost not shown here is that the grid itself would go from 48 to 96 across to keep the same land. That means four times the cells the land, the ways and the cats read, and every distance in the rules doubled. Examples are arcade spacing, how far a court looks, and the bay lengths of the fronts.

## What it takes a hand to build

These numbers come from a model of the gestures:

- each storey is laid in straight strokes (the fewest runs);
- "travel" is how far the finger goes, with a cell as one unit;
- an arch cut is one stroke.

| | strokes | travel | taps, cell by cell | strokes with a brush 2 wide | travel |
|---|---|---|---|---|---|
| 17 cells | 27 | 122 | 122 | — | — |
| 18 half grid, as cells | 54 | 244 | 488 | 28 | 122 |
| 19 half grid, its own | 70 | 216 | 431 | 66 | 120 |

- **Same house, half grid:** built with a brush one half cell wide, it takes twice the strokes and twice the travel. Raising it cell by cell takes four times the taps.
- **A brush two half cells wide** (the default it would want) brings the same house back to today's effort. What thickness the brush has decides most of the cost, not the grid.
- **The half grid's own house:** its extra strokes are mostly its extra detail:
  - about a dozen piers and pilasters, each one tap;
  - thin walls, each one stroke;
  - the set-back storey.
- **The conclusion on effort:** detail costs gestures in proportion to how much of it there is, and plain mass costs what it does today.

## What you can place yourself

**Cells.** A wall or a way is a whole cell or nothing. Today, the in-between comes only from the rules:

- piers and corbels the resolver makes;
- the wall piece's thin walls;
- what the fronts compose: galleries, portals, jetties.

The hand can't set a wall half back, put a pilaster on a front, or make a path narrower than a cell.

**The half grid's own house** (19) shows all of these placed by hand:

- piers half a cell thick, with arches a cell wide between them (the resolver arcades them as it would any run);
- a storey set back half a cell;
- a gate recessed into its front;
- pilasters;
- a thin wall through the court;
- a path half a cell wide.

Each reads at the zoom you'd place it at (the bottom row of the sheet).

**What breaks:** the rules still measure in cells.

- **Windows:** each face is given one window per half cell, so 19's fronts have twice as many, narrow and close-set.
- **Roofs:** in the middle sea, roofs formed only over the north wing, not over the wings a cell and a half deep.
- **18:** as cells it holds together because its fronts are still two half cells to a bay. 19's are not.

This is the real work a move to the half grid would need: the rules reading a run of two half cells as one bay, and a wing's depth as a length, not a count.

## Legible on a phone?

At a phone's size (390 × 844, as the app opens):

- a cell comes to **27 px**;
- on the half grid, a half cell comes to **15 px**.

A finger is about 40–45 px. Placing a single half cell needs the view zoomed in about twice (**31 px**, the bottom row). Pinching in is already the gesture for this; the default framing stays as it is.

The overview stays legible, and slightly richer: 19's setbacks, pilasters and recess read at the default zoom; 18 reads as 17 does.

## Edge walls, reckoned by hand

**Building the courtyard house with edge walls takes:**

- 2 closed traces, the outline and the court;
- 4 short traces between the wings;
- 1 fill a storey per wing (9 fills).

That is about 15 gestures, fewer than today's 27. Walls are thin by definition.

**But the model has no rooms.**

- Air enclosed under stone becomes an arch, a span or a passage. The resolver, the ways and the cats all read solid cells.
- Edge walls would need a new primitive: a room, which is enclosed air under a roof.
- They would also need a second way of drawing, with walls on lines rather than in cells.

**What edge walls show from outside:**

- At the façade, a thin wall on an edge and a half-cell wall look much the same.
- Where they differ is inside, and the camera looks at roofs, courts and fronts, not interiors.
- Thick things (piers, buttresses, a deep gate) would still need cells.

So edge walls cost the most to build into the model, and pay off mostly where the view doesn't look.

## Where it leaves us

**The half grid works**, in look, in cost (about 2× to mesh) and in effort, provided:

- the default brush is two half cells wide, so mass is as quick to build as today and thin is a choice;
- the rules learn bays: one opening, one roof span or one arcade bay per cell's width, whatever the grid.

The second of these is the bigger job, and it's the one to try next before deciding. Making 19 read right (windows by bay, roofs over 1.5-cell wings) is a contained change on the fixture. If it closes the gap, the move to N=96 with a two-wide brush is mostly mechanical. If it doesn't, keep cells and add the half-thick pieces as rules-made kinds instead:

- setback;
- pilaster;
- narrow path.

**Edge walls aren't worth a new primitive for this camera.**
